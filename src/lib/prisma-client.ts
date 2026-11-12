import { PrismaClient } from '../../generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

/**
 * Singleton PrismaClient instance.
 * This ensures only one database connection pool exists across the application,
 * shared between the auth module and NestJS services.
 */
let prismaClientInstance: PrismaClient | null = null;

export const getPrismaClient = (): PrismaClient => {
  if (!prismaClientInstance) {
    const configuredUrl = process.env.DATABASE_URL?.trim().replace(/^(["'])(.*)\1$/, '$2');
    if (!configuredUrl) {
      throw new Error('DATABASE_URL must be configured');
    }

    const databaseUrl = new URL(configuredUrl);
    if (!databaseUrl.searchParams.has('sslmode')) {
      databaseUrl.searchParams.set('sslmode', 'require');
    }
    if (
      databaseUrl.searchParams.get('sslmode') === 'require' &&
      !databaseUrl.searchParams.has('uselibpqcompat')
    ) {
      databaseUrl.searchParams.set('uselibpqcompat', 'true');
    }

    const adapter = new PrismaPg({
      connectionString: databaseUrl.toString(),
    });
    prismaClientInstance = new PrismaClient({ adapter });
  }
  return prismaClientInstance;
};

// Re-export for type usage
export { PrismaClient } from '../../generated/prisma/client';
