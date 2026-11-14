import { Test, TestingModule } from '@nestjs/testing';
import { AdminTryoutService } from '../services/tryout.service';
import { PrismaService } from '../../../prisma.service';
import { CreateTryoutDto } from '../dto/create-tryout.dto';
import { UpdateTryoutDto } from '../dto/update-tryout.dto';
import { NotFoundException } from '@nestjs/common';

// Redefine enums locally to avoid Prisma client resolution issues in tests
enum TryoutBatch {
  SNBT = 'SNBT',
  MANDIRI = 'MANDIRI',
}

enum TryoutStatus {
  NOT_STARTED = 'NOT_STARTED',
  IN_PROGRESS = 'IN_PROGRESS',
  FINISHED = 'FINISHED',
}

describe('AdminService', () => {
  let tryoutService: AdminTryoutService;
  let prisma: PrismaService;

  // Mock Prisma Service
  const mockPrismaService = {
    tryOut: {
      count: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminTryoutService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
      ],
    }).compile();

    tryoutService = module.get<AdminTryoutService>(AdminTryoutService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(tryoutService).toBeDefined();
  });

  describe('getTryouts', () => {
    it('should return an array of tryouts', async () => {
      // Arrange
      const mockTryouts = [
        { id: '1', title: 'Tryout 1', status: 'NOT_STARTED', _count: { attempts: 0 } },
        { id: '2', title: 'Tryout 2', status: 'NOT_STARTED', _count: { attempts: 0 } },
      ];
      mockPrismaService.tryOut.findMany.mockResolvedValue(mockTryouts);
      mockPrismaService.tryOut.count.mockResolvedValue(mockTryouts.length);

      // Act
      const result = await tryoutService.getTryouts();

      // Assert
      expect(result).toEqual({
        data: [
          { id: '1', title: 'Tryout 1', status: 'NOT_STARTED', participantsCount: 0 },
          { id: '2', title: 'Tryout 2', status: 'NOT_STARTED', participantsCount: 0 },
        ],
        meta: {
          total: 2,
          page: 1,
          lastPage: 1,
        },
      });
      expect(prisma.tryOut.findMany).toHaveBeenCalledWith({
        skip: 0,
        take: 10,
        orderBy: { createdAt: 'asc' },
        select: expect.any(Object),
      });
      expect(prisma.tryOut.count).toHaveBeenCalledTimes(1);
    });
  });

  describe('createTryout', () => {
    const baseDto: CreateTryoutDto = {
      title: 'New Tryout',
      description: 'Desc',
      solutionPrice: 10,
      batch: TryoutBatch.SNBT as any,
      releaseDate: new Date().toISOString(),
      scheduledEnd: new Date(
        new Date().setDate(new Date().getDate() + 5),
      ).toISOString(),
      scheduledStart: '', // to be set in tests
    };

    it('should create a tryout with status IN_PROGRESS if scheduledStart is now or past', async () => {
      // Arrange
      const pastDate = new Date();
      pastDate.setDate(pastDate.getDate() - 1);

      const dto = { ...baseDto, scheduledStart: pastDate.toISOString() };

      const expectedResult = {
        id: '1',
        title: dto.title,
        status: TryoutStatus.IN_PROGRESS,
      };
      mockPrismaService.tryOut.create.mockResolvedValue(expectedResult);

      // Act
      const result = await tryoutService.createTryout(dto);

      // Assert
      expect(prisma.tryOut.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'IN_PROGRESS',
            scheduledStart: expect.any(Date),
          }),
        }),
      );
      expect(result).toEqual(expectedResult);
    });

    it('should create a tryout with status NOT_STARTED if scheduledStart is future', async () => {
      // Arrange
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 2); // 2 days in future

      const dto = { ...baseDto, scheduledStart: futureDate.toISOString() };

      const expectedResult = {
        id: '1',
        title: dto.title,
        status: TryoutStatus.NOT_STARTED,
      };
      mockPrismaService.tryOut.create.mockResolvedValue(expectedResult);

      // Act
      const result = await tryoutService.createTryout(dto);

      // Assert
      expect(prisma.tryOut.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'NOT_STARTED',
            scheduledStart: expect.any(Date),
          }),
        }),
      );
      expect(result).toEqual(expectedResult);
    });
  });

  describe('updateTryout', () => {
    const updateDto: UpdateTryoutDto = {
      title: 'Updated Title',
      solutionPrice: 20,
    };

    it('should throw NotFoundException if tryout does not exist', async () => {
      // Arrange
      mockPrismaService.tryOut.findUnique.mockResolvedValue(null);

      // Act & Assert
      await expect(
        tryoutService.updateTryout('non-existent-id', updateDto),
      ).rejects.toThrow(NotFoundException);
    });

    it('should update and return tryout if it exists', async () => {
      // Arrange
      mockPrismaService.tryOut.findUnique.mockResolvedValue({ id: '1' });
      const expectedResult = { id: '1', ...updateDto };
      mockPrismaService.tryOut.update.mockResolvedValue(expectedResult);

      // Act
      const result = await tryoutService.updateTryout('1', updateDto);

      // Assert
      expect(prisma.tryOut.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: '1' },
          data: expect.objectContaining({
            title: updateDto.title,
            solutionPrice: updateDto.solutionPrice,
          }),
        }),
      );
      expect(result).toEqual(expectedResult);
    });

    it('should parse dates correctly when updating', async () => {
      // Arrange
      const dateDto: UpdateTryoutDto = {
        scheduledStart: '2025-01-01T00:00:00Z',
      };
      mockPrismaService.tryOut.findUnique.mockResolvedValue({ id: '1' });
      mockPrismaService.tryOut.update.mockResolvedValue({ id: '1' });

      // Act
      await tryoutService.updateTryout('1', dateDto);

      // Assert
      expect(prisma.tryOut.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            scheduledStart: new Date('2025-01-01T00:00:00Z'),
          }),
        }),
      );
    });
  });

  describe('deleteTryout', () => {
    it('should throw NotFoundException if tryout does not exist', async () => {
      // Arrange
      mockPrismaService.tryOut.findUnique.mockResolvedValue(null);

      // Act & Assert
      await expect(
        tryoutService.deleteTryout('non-existent-id'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should delete and return tryout info if exists', async () => {
      // Arrange
      const mockTryout = { id: '1', title: 'To Be Deleted' };
      mockPrismaService.tryOut.findUnique.mockResolvedValue(mockTryout);
      mockPrismaService.tryOut.delete.mockResolvedValue(mockTryout);

      // Act
      const result = await tryoutService.deleteTryout('1');

      // Assert
      expect(prisma.tryOut.delete).toHaveBeenCalledWith({
        where: { id: '1' },
        select: { id: true, title: true },
      });
      expect(result).toEqual(mockTryout);
    });
  });
});
