import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma.service';
import { CreateTryoutDto } from '../dto/create-tryout.dto';
import { UpdateTryoutDto } from '../dto/update-tryout.dto';
import { NotFoundException } from '@nestjs/common';

@Injectable()
export class AdminTryoutService {
  constructor(private readonly prisma: PrismaService) {}

  async getTryouts(page = 1, limit = 10) {
    const skip = (page - 1) * limit;
    const now = new Date();

    const [data, total] = await Promise.all([
      this.prisma.tryOut.findMany({
        skip,
        take: limit,
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          code: true,
          title: true,
          solutionPrice: true,
          releaseDate: true,
          scheduledStart: true,
          scheduledEnd: true,
          status: true,
          isPublic: true,
          isSpecial: true,
          referralCode: true,
        },
      }),
      this.prisma.tryOut.count(),
    ]);

    // Calculate dynamic status based on time
    const formattedData = data.map((item) => {
      let currentStatus = item.status;

      if (item.scheduledEnd && now > item.scheduledEnd) {
        currentStatus = 'FINISHED';
      } else if (item.scheduledStart && item.scheduledEnd) {
        if (now < item.scheduledStart) {
          currentStatus = 'NOT_STARTED';
        } else if (now >= item.scheduledStart && now <= item.scheduledEnd) {
          currentStatus = 'IN_PROGRESS';
        }
      }

      return {
        ...item,
        status: currentStatus,
      };
    });

    return {
      data: formattedData,
      meta: {
        total,
        page,
        lastPage: Math.ceil(total / limit),
      },
    };
  }

  async getTryoutById(id: string) {
    return this.prisma.tryOut.findUnique({
      where: { id },
    });
  }

  async getTryoutPreview(id: string) {
    const tryout = await this.prisma.tryOut.findUnique({
      where: { id },
      include: {
        subtests: {
          orderBy: { order: 'asc' },
          include: {
            questions: {
              orderBy: { id: 'asc' },
              include: {
                items: { orderBy: { order: 'asc' } },
              },
            },
          },
        },
      },
    });

    if (!tryout) throw new NotFoundException('Tryout tidak ditemukan');
    return tryout;
  }

  async createTryout(dto: CreateTryoutDto) {
    const start = new Date(dto.scheduledStart);
    const end = new Date(dto.scheduledEnd);
    const now = new Date();

    let status: 'NOT_STARTED' | 'IN_PROGRESS' | 'FINISHED' = 'NOT_STARTED';
    if (now > end) {
      status = 'FINISHED';
    } else if (now >= start) {
      status = 'IN_PROGRESS';
    }

    return await this.prisma.tryOut.create({
      data: {
        title: dto.title,
        description: dto.description,
        solutionPrice: dto.solutionPrice,
        batch: dto.batch,
        releaseDate: new Date(dto.releaseDate),
        scheduledStart: start,
        scheduledEnd: end,
        status: status,
        isPublic: dto.isPublic ?? true,
        isSpecial: dto.isSpecial ?? false,
        referralCode: dto.referralCode || null,
      },

      select: {
        id: true,
        code: true,
        title: true,
        isSpecial: true,
        scheduledStart: true,
        releaseDate: true,
        scheduledEnd: true,
        createdAt: true,
      },
    });
  }

  async updateTryout(id: string, dto: UpdateTryoutDto) {
    const existingTryout = await this.prisma.tryOut.findUnique({
      where: { id },
    });

    if (!existingTryout) {
      throw new NotFoundException('Tryout tidak ditemukan');
    }

    const start = dto.scheduledStart
      ? new Date(dto.scheduledStart)
      : existingTryout.scheduledStart;
    const end = dto.scheduledEnd
      ? new Date(dto.scheduledEnd)
      : existingTryout.scheduledEnd;
    const now = new Date();

    let newStatus = existingTryout.status;
    if (end && now > end) {
      newStatus = 'FINISHED';
    } else if (start && end) {
      if (now >= start) {
        newStatus = 'IN_PROGRESS';
      } else {
        newStatus = 'NOT_STARTED';
      }
    }

    return await this.prisma.tryOut.update({
      where: { id },
      data: {
        title: dto.title,
        solutionPrice: dto.solutionPrice,
        scheduledStart: start,
        scheduledEnd: end,
        releaseDate: dto.releaseDate && new Date(dto.releaseDate),
        description: dto.description,
        isPublic: dto.isPublic,
        isSpecial: dto.isSpecial,
        referralCode: dto.referralCode || null,
        status: newStatus,
      },
      select: {
        id: true,
        code: true,
        title: true,
        isSpecial: true,
        scheduledStart: true,
        releaseDate: true,
        scheduledEnd: true,
        createdAt: true,
      },
    });
  }

  async deleteTryout(id: string) {
    const existingTryout = await this.prisma.tryOut.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!existingTryout) {
      throw new NotFoundException('Tryout tidak ditemukan');
    }

    return await this.prisma.tryOut.delete({
      where: { id },
      select: {
        id: true,
        title: true,
      },
    });
  }
}
