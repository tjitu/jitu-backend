import { Type } from 'class-transformer';
import { IsIn, IsInt, IsObject, IsOptional, IsString, IsUUID, MaxLength, Min, ValidateNested } from 'class-validator';

export class GrowthSubmissionDto {
  @IsString() @MaxLength(31) @IsOptional() instagramUsername?: string;
  @IsObject() checklist!: Record<string, boolean>;
  @IsUUID('4') requestKey!: string;
  @IsUUID('4') @IsOptional() sessionId?: string;
  @IsInt() @Min(0) configVersion!: number;
  @IsInt() @Min(1) @IsOptional() version?: number;
}
export class RegisterTryoutDto {
  @IsIn(['FREE', 'PREMIUM']) @IsOptional() mode?: 'FREE' | 'PREMIUM';
  @IsInt() @Min(0) @IsOptional() expectedSolutionPrice?: number;
  @ValidateNested() @Type(() => GrowthSubmissionDto) @IsOptional() growth?: GrowthSubmissionDto;
}
export class GrowthClientEventDto {
  @IsIn(['registration_button_clicked','social_engagement_modal_viewed','social_engagement_link_clicked',
    'social_engagement_modal_abandoned','community_invitation_clicked','community_invitation_viewed']) event!: string;
  @IsUUID('4') eventId!: string;
  @IsUUID('4') sessionId!: string;
  @IsIn(['follow','likeTag','story']) @IsOptional() link?: string;
}
