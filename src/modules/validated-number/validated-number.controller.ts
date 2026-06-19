import { Controller, Get, Post, Delete, Body, Param, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';
import { ValidatedNumberService } from './validated-number.service';
import {
  BulkSaveValidatedNumbersDto,
  SaveValidatedNumberDto,
  ValidatedNumbersVaultResponseDto,
} from './dto/validated-number.dto';
import { RequireRole } from '../auth/decorators/auth.decorators';
import { ApiKeyRole } from '../auth/entities/api-key.entity';

@ApiTags('validated-numbers')
@Controller('validated-numbers')
export class ValidatedNumberController {
  constructor(private readonly validatedNumberService: ValidatedNumberService) {}

  @Get()
  @RequireRole(ApiKeyRole.VIEWER)
  @ApiOperation({ summary: 'List all validated WhatsApp numbers grouped by country' })
  @ApiResponse({ status: 200, type: ValidatedNumbersVaultResponseDto })
  async findAll(): Promise<ValidatedNumbersVaultResponseDto> {
    return this.validatedNumberService.findAllGrouped();
  }

  @Post()
  @RequireRole(ApiKeyRole.OPERATOR)
  @ApiOperation({ summary: 'Save or update a validated WhatsApp number' })
  @ApiResponse({ status: 201, description: 'Number saved' })
  async save(@Body() dto: SaveValidatedNumberDto) {
    const saved = await this.validatedNumberService.upsert(dto);
    return {
      e164: saved.e164,
      whatsappId: saved.whatsappId,
      countryCode: saved.countryCode,
      verifiedAt: saved.verifiedAt.toISOString(),
    };
  }

  @Post('bulk')
  @RequireRole(ApiKeyRole.OPERATOR)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Bulk save validated WhatsApp numbers' })
  async saveBulk(@Body() dto: BulkSaveValidatedNumbersDto) {
    const saved = await this.validatedNumberService.upsertMany(dto.numbers);
    return { saved };
  }

  @Delete('country/:countryCode')
  @RequireRole(ApiKeyRole.OPERATOR)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Remove all validated numbers for a country' })
  @ApiParam({ name: 'countryCode', description: 'ISO country code (e.g. GB)' })
  async removeCountry(@Param('countryCode') countryCode: string) {
    const removed = await this.validatedNumberService.removeByCountry(countryCode.toUpperCase());
    return { removed };
  }

  @Delete('e164/:digits')
  @RequireRole(ApiKeyRole.OPERATOR)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Remove a validated number by E.164 digits' })
  @ApiParam({ name: 'digits', description: 'E.164 digits only (e.g. 628123456789)' })
  async removeByE164(@Param('digits') digits: string) {
    const e164 = digits.startsWith('+') ? digits : `+${digits.replace(/\D/g, '')}`;
    const removed = await this.validatedNumberService.removeByE164(e164);
    return { removed };
  }

  @Delete()
  @RequireRole(ApiKeyRole.OPERATOR)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Clear all validated numbers' })
  async clearAll() {
    await this.validatedNumberService.clearAll();
    return { cleared: true };
  }
}
