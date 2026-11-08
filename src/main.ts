import { NestFactory, Reflector } from '@nestjs/core';
import { AppModule } from './app.module';
import { ClassSerializerInterceptor, ValidationPipe } from '@nestjs/common';

async function bootstrap() {
  // Enable standard NestJS body parser
  // Auth routes that need raw body are handled via middleware exclusion in AppModule
  const app = await NestFactory.create(AppModule, {
    rawBody: true, // Enable raw body for webhook routes that need it
  });

  app.getHttpAdapter().getInstance().set('trust proxy', 1);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );

  // Parse allowed origins from environment variable
  const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',').map((o) =>
    o.trim(),
  );

  // Validate CORS configuration in production
  if (process.env.NODE_ENV === 'production' && !allowedOrigins?.length) {
    throw new Error('ALLOWED_ORIGINS must be set in production');
  }

  app.enableCors({
    origin: allowedOrigins?.length ? allowedOrigins : true,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-user-id'],
  });

  app.useGlobalInterceptors(new ClassSerializerInterceptor(app.get(Reflector)));

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
