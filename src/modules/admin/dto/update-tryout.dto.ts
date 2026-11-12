import {
  IsString,
  IsInt,
  IsDateString,
  IsOptional,
  IsBoolean,
} from 'class-validator';

export class UpdateTryoutDto {
  @IsString()
  @IsOptional()
  title?: string;

  @IsInt()
  @IsOptional()
  solutionPrice?: number;

  @IsDateString()
  @IsOptional()
  releaseDate?: string;

  @IsDateString()
  @IsOptional()
  scheduledStart?: string;

  @IsDateString()
  @IsOptional()
  scheduledEnd?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsBoolean()
  @IsOptional()
  isPublic?: boolean;

  @IsBoolean()
  @IsOptional()
  isSpecial?: boolean;

  @IsString()
  @IsOptional()
  referralCode?: string;
}
