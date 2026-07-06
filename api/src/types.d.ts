import '@fastify/jwt';
declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: any, reply: any) => Promise<void>;
    authenticatePlatform: (request: any, reply: any) => Promise<void>;
  }
  interface FastifyRequest {
    tenantId: string;
    authUser: { userId: string; tenantId: string; role: string };
    platformUser: { userId: string; scope: 'platform'; role: string };
  }
}
declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { userId: string; tenantId?: string; scope?: 'platform'; role: string };
    user: { userId: string; tenantId?: string; scope?: 'platform'; role: string; iat?: number; exp?: number };
  }
}
