// eslint-disable-next-line @typescript-eslint/no-var-requires
require("@remix-run/dev/dist/compiler/compileBrowser").createBrowserCompiler =
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require("@effect/remix-plugin/compiler/browser").createBrowserCompiler

// eslint-disable-next-line @typescript-eslint/no-var-requires
require("@remix-run/dev/dist/compiler/compilerServer").createServerCompiler =
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require("@effect/remix-plugin/compiler/server").createServerCompiler

// eslint-disable-next-line @typescript-eslint/no-var-requires
const index = require("@remix-run/dev/dist/index.js")

const cli = index.cli
const argv = process.argv

process.env["NODE_ENV"] = "production"
process.argv = [...argv, "build"]

cli.run().then(
  () => {
    process.exit(0)
  },
  (error: any) => {
    // for expected errors we only show the message (if any), no stack trace
    if (error instanceof index.CliError) error = error.message
    if (error) console.error(error)
    process.exit(1)
  }
)

export {}
