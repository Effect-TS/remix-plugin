import { NodeModulesPolyfillPlugin } from "@esbuild-plugins/node-modules-polyfill"
import * as esbuild from "esbuild"
import { builtinModules as nodeBuiltins } from "module"
import * as path from "path"

import { effectPlugin } from "@effect/remix-plugin/plugins/effect"
import { type WriteChannel } from "@remix-run/dev/dist/channel"
import { type AssetsManifest, createAssetsManifest } from "@remix-run/dev/dist/compiler/assets"
import { getAppDependencies } from "@remix-run/dev/dist/compiler/dependencies"
import { loaders } from "@remix-run/dev/dist/compiler/loaders"
import { type CompileOptions } from "@remix-run/dev/dist/compiler/options"
import { browserRouteModulesPlugin } from "@remix-run/dev/dist/compiler/plugins/browserRouteModulesPlugin"
import { cssFilePlugin } from "@remix-run/dev/dist/compiler/plugins/cssFilePlugin"
import { deprecatedRemixPackagePlugin } from "@remix-run/dev/dist/compiler/plugins/deprecatedRemixPackagePlugin"
import { emptyModulesPlugin } from "@remix-run/dev/dist/compiler/plugins/emptyModulesPlugin"
import { mdxPlugin } from "@remix-run/dev/dist/compiler/plugins/mdx"
import { urlImportsPlugin } from "@remix-run/dev/dist/compiler/plugins/urlImportsPlugin"
import { writeFileSafe } from "@remix-run/dev/dist/compiler/utils/fs"
import { type RemixConfig } from "@remix-run/dev/dist/config"

export type BrowserCompiler = {
  // produce ./public/build/
  compile: (manifestChannel: WriteChannel<AssetsManifest>) => Promise<void>
  dispose: () => void
}

const getExternals = (remixConfig: RemixConfig): Array<string> => {
  // For the browser build, exclude node built-ins that don't have a
  // browser-safe alternative installed in node_modules. Nothing should
  // *actually* be external in the browser build (we want to bundle all deps) so
  // this is really just making sure we don't accidentally have any dependencies
  // on node built-ins in browser bundles.
  const dependencies = Object.keys(getAppDependencies(remixConfig))
  const fakeBuiltins = nodeBuiltins.filter((mod) => dependencies.includes(mod))

  if (fakeBuiltins.length > 0) {
    throw new Error(
      `It appears you're using a module that is built in to node, but you installed it as a dependency which could cause problems. Please remove ${
        fakeBuiltins.join(
          ", "
        )
      } before continuing.`
    )
  }
  return nodeBuiltins.filter((mod) => !dependencies.includes(mod))
}

const writeAssetsManifest = async (config: RemixConfig, assetsManifest: AssetsManifest) => {
  const filename = `manifest-${assetsManifest.version.toUpperCase()}.js`

  assetsManifest.url = config.publicPath + filename

  await writeFileSafe(
    path.join(config.assetsBuildDirectory, filename),
    `window.__remixManifest=${JSON.stringify(assetsManifest)};`
  )
}

const createEsbuildConfig = (
  config: RemixConfig,
  options: CompileOptions
): esbuild.BuildOptions | esbuild.BuildIncremental => {
  const entryPoints: esbuild.BuildOptions["entryPoints"] = {
    "entry.client": path.resolve(config.appDirectory, config.entryClientFile)
  }
  for (const id of Object.keys(config.routes)) {
    // All route entry points are virtual modules that will be loaded by the
    // browserEntryPointsPlugin. This allows us to tree-shake server-only code
    // that we don't want to run in the browser (i.e. action & loader).
    entryPoints[id] = config.routes[id].file + "?browser"
  }

  const plugins = [
    effectPlugin(),
    deprecatedRemixPackagePlugin(options.onWarning),
    cssFilePlugin(options),
    urlImportsPlugin(),
    mdxPlugin(config),
    browserRouteModulesPlugin(config, /\?browser$/),
    emptyModulesPlugin(config, /\.server(\.[jt]sx?)?$/),
    NodeModulesPolyfillPlugin()
  ]

  return {
    entryPoints,
    outdir: config.assetsBuildDirectory,
    platform: "browser",
    format: "esm",
    external: getExternals(config),
    loader: loaders,
    bundle: true,
    logLevel: "silent",
    splitting: true,
    sourcemap: options.sourcemap,
    // As pointed out by https://github.com/evanw/esbuild/issues/2440, when tsconfig is set to
    // `undefined`, esbuild will keep looking for a tsconfig.json recursively up. This unwanted
    // behavior can only be avoided by creating an empty tsconfig file in the root directory.
    tsconfig: config.tsconfigPath,
    mainFields: ["browser", "module", "main"],
    treeShaking: true,
    minify: options.mode === "production",
    entryNames: "[dir]/[name]-[hash]",
    chunkNames: "_shared/[name]-[hash]",
    assetNames: "_assets/[name]-[hash]",
    publicPath: config.publicPath,
    define: {
      "process.env.NODE_ENV": JSON.stringify(options.mode),
      "process.env.REMIX_DEV_SERVER_WS_PORT": JSON.stringify(config.devServerPort)
    },
    jsx: "automatic",
    jsxDev: options.mode !== "production",
    plugins
  }
}

export const createBrowserCompiler = (
  remixConfig: RemixConfig,
  options: CompileOptions
): BrowserCompiler => {
  let compiler: esbuild.BuildIncremental
  const esbuildConfig = createEsbuildConfig(remixConfig, options)
  const compile = async (manifestChannel: WriteChannel<AssetsManifest>) => {
    let metafile: esbuild.Metafile
    if (compiler === undefined) {
      compiler = await esbuild.build({
        ...esbuildConfig,
        metafile: true,
        incremental: true
      })
      metafile = compiler.metafile!
    } else {
      metafile = (await compiler.rebuild()).metafile!
    }
    const manifest = await createAssetsManifest(remixConfig, metafile)
    manifestChannel.write(manifest)
    await writeAssetsManifest(remixConfig, manifest)
  }
  return {
    compile,
    dispose: () => compiler?.rebuild.dispose()
  }
}
