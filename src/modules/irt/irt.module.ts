import { Module } from '@nestjs/common';
import { IrtService } from './irt.service';
import { PrismaModule } from '../../prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [IrtService],
  exports: [IrtService],
})
export class IrtModule {}
