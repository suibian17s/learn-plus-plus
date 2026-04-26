declare module 'pdf-parse' {
  function pdfParse(buffer: Buffer): Promise<{
    text: string
    numpages: number
    info: Record<string, any>
    metadata: Record<string, any>
    version: string
  }>
  export = pdfParse
}

declare module 'pdfkit' {
  import stream from 'stream'
  class PDFDocument extends stream.Readable {
    constructor(options?: {
      size?: string | [number, number]
      margin?: number
      layout?: 'portrait' | 'landscape'
      [key: string]: any
    })
    font(name: string): this
    registerFont(name: string, path: string): this
    fontSize(size: number): this
    text(text: string, options?: any): this
    moveDown(line?: number): this
    end(): void
    on(event: string, cb: (...args: any[]) => void): this
    once(event: string, cb: (...args: any[]) => void): this
  }
  export = PDFDocument
}

declare module 'officeparser' {
  function parseOfficeAsync(filePath: string): Promise<string>
}

declare module 'mammoth' {
  interface MammothResult {
    value: string
    messages: Array<{ type: string; message: string; error?: Error }>
  }
  interface MammothOptions {
    buffer?: Buffer
    path?: string
  }
  function extractRawText(options: MammothOptions): Promise<MammothResult>
}
