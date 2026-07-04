declare module 'node-imap' {
  interface ImapConfig {
    user: string
    password: string
    host: string
    port: number
    tls: boolean
    tlsOptions?: { rejectUnauthorized: boolean }
    connTimeout?: number
    authTimeout?: number
  }

  interface Box {
    messages: { total: number; new: number }
  }

  interface FetchStream extends NodeJS.EventEmitter {
    on(event: 'message', cb: (msg: any, seqno: number) => void): void
    on(event: 'error', cb: (err: Error) => void): void
    on(event: 'end', cb: () => void): void
    once(event: 'error', cb: (err: Error) => void): void
    once(event: 'end', cb: () => void): void
  }

  class Imap {
    state: string
    constructor(config: ImapConfig)
    connect(): void
    end(): void
    on(event: 'ready', cb: () => void): void
    on(event: 'error', cb: (err: Error) => void): void
    once(event: 'ready', cb: () => void): void
    once(event: 'error', cb: (err: Error) => void): void
    openBox(name: string, readOnly: boolean, cb: (err: Error | null, box: Box) => void): void
    seq: {
      fetch(source: string, options: { bodies: string | string[]; struct?: boolean }): FetchStream
    }
  }

  export = Imap
}
