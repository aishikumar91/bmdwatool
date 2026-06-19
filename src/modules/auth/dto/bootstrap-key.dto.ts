import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';

export class BootstrapKeyBodyDto {
  @ApiPropertyOptional({ description: 'Mint a new admin key even when data/.api-key exists' })
  @IsOptional()
  @IsBoolean()
  force?: boolean;
}
