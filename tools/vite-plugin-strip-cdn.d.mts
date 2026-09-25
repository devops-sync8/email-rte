import type { Plugin } from 'vite';
export declare const BLOCKED_HOSTS: string[];
export declare const BLOCKED_URL_RE: RegExp;
export declare function stripCdnUrls(): Plugin;
export default stripCdnUrls;
