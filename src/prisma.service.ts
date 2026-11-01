import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { getPrismaClient, PrismaClient } from './lib/prisma-client';

/**
 * PrismaService wraps the singleton PrismaClient instance.
 * This ensures only one database connection pool exists across the entire application,
 * including the auth module which initializes before NestJS DI.
 */
@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  private readonly client: PrismaClient;

  constructor() {
    this.client = getPrismaClient();
  }

  async onModuleInit() {
    await this.client.$connect();
  }

  async onModuleDestroy() {
    await this.client.$disconnect();
  }

  // Proxy all PrismaClient properties
  get user() {
    return this.client.user;
  }
  get session() {
    return this.client.session;
  }
  get account() {
    return this.client.account;
  }
  get verification() {
    return this.client.verification;
  }
  get tryOut() {
    return this.client.tryOut;
  }
  get dailyQuestionLog() {
    return this.client.dailyQuestionLog;
  }
  get subtest() {
    return this.client.subtest;
  }
  get question() {
    return this.client.question;
  }
  get questionItem() {
    return this.client.questionItem;
  }
  get tokenTransaction() {
    return this.client.tokenTransaction;
  }
  get tokenPackage() {
    return this.client.tokenPackage;
  }
  get payment() {
    return this.client.payment;
  }
  get unlockedSolution() {
    return this.client.unlockedSolution;
  }
  get tryOutAttempt() {
    return this.client.tryOutAttempt;
  }
  get article() {
    return this.client.article;
  }
  get userAnswer() {
    return this.client.userAnswer;
  }

  // Proxy transaction and raw query methods
  $transaction<T>(fn: Parameters<PrismaClient['$transaction']>[0]): Promise<T> {
    return this.client.$transaction(fn) as Promise<T>;
  }

  $queryRaw<T = unknown>(
    ...args: Parameters<PrismaClient['$queryRaw']>
  ): Promise<T> {
    return this.client.$queryRaw(...args) as Promise<T>;
  }

  $executeRaw(
    ...args: Parameters<PrismaClient['$executeRaw']>
  ): Promise<number> {
    return this.client.$executeRaw(...args) as Promise<number>;
  }
}

export { PrismaClient } from './lib/prisma-client';
