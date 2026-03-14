declare module 'dotenv' {
  export type DotenvConfigOutput = {
    parsed?: Record<string, string>
    error?: Error
  }

  export type DotenvConfigOptions = {
    path?: string
    encoding?: string
    debug?: boolean
    override?: boolean
  }

  export function config(options?: DotenvConfigOptions): DotenvConfigOutput
}
