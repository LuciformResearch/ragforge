/**
 * Type declarations for @nisyaban/tika-server
 * The original package declares "tika-server" instead of "@nisyaban/tika-server"
 */

declare module '@nisyaban/tika-server' {
  export interface TikaServerOptions {
    javaBinary?: string;
    javaOptions?: string;
    tikaBinary?: string;
    tikaConfig?: string;
    tikaOptions?: string;
    tikaHost?: string;
    tikaPortMin?: number;
    tikaPortMax?: number;
  }

  export interface QueryOptions {
    endpoint?: string;
    type?: string;
    accept?: string;
    response?: string;
    maxlength?: number;
    filename?: string;
  }

  export interface MetaOptions {
    type?: string;
    filename?: string;
  }

  export default class TikaServer {
    constructor(options?: TikaServerOptions);

    on(event: string, callback: (event: any) => void): void;
    start(): Promise<void>;
    query(content: any, options?: QueryOptions): Promise<any>;
    queryMeta(content: any, options?: MetaOptions): Promise<Record<string, any>>;
    queryText(content: any, options?: MetaOptions): Promise<string>;
    stop(): Promise<void>;
  }
}
