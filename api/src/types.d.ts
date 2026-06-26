import '@fastify/jwt';
declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: any, reply: any) => Promise<void>;
    requireOperator: (request: any, reply: any) => Promise<void>;
  }
  interface FastifyRequest {
    tenantId: string;
    authUser: { userId: string; tenantId: string; role: string };
  }
}
declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { userId: string; tenantId: string; role: string };
    user: { userId: string; tenantId: string; role: string; iat?: number; exp?: number };
  }
}
