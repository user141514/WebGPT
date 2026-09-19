import { type Server } from 'node:http';
export declare const CLIENT_PORT = 4317;
export interface ClientAsset {
    file: string;
    contentType: string;
}
export interface ClientServerOptions {
    root?: string;
}
export declare function resolveClientAsset(requestUrl: string, root?: string): ClientAsset | null;
export declare function createClientServer(options?: ClientServerOptions): Server;
