import { IsString, IsNotEmpty, IsArray, ValidateNested, IsISO8601, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SaveValidatedNumberDto {
  @ApiProperty({ example: '+628123456789' })
  @IsString()
  @IsNotEmpty()
  e164: string;

  @ApiProperty({ example: '628123456789@c.us' })
  @IsString()
  @IsNotEmpty()
  whatsappId: string;

  @ApiProperty({ example: 'ID' })
  @IsString()
  @IsNotEmpty()
  countryCode: string;

  @ApiProperty({ example: 'Indonesia' })
  @IsString()
  @IsNotEmpty()
  countryName: string;

  @ApiProperty({ example: '🇮🇩' })
  @IsString()
  @IsNotEmpty()
  flag: string;

  @ApiProperty({ example: '62' })
  @IsString()
  @IsNotEmpty()
  dialCode: string;

  @ApiProperty({ example: '8123456789' })
  @IsString()
  @IsNotEmpty()
  nationalNumber: string;

  @ApiProperty({ example: '2026-06-17T12:00:00.000Z' })
  @IsISO8601()
  verifiedAt: string;
}

export class BulkSaveValidatedNumbersDto {
  @ApiProperty({ type: [SaveValidatedNumberDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SaveValidatedNumberDto)
  numbers: SaveValidatedNumberDto[];
}

export class ValidatedNumberResponseDto {
  @ApiProperty()
  e164: string;

  @ApiProperty()
  whatsappId: string;

  @ApiProperty()
  countryCode: string;

  @ApiProperty()
  countryName: string;

  @ApiProperty()
  flag: string;

  @ApiProperty()
  dialCode: string;

  @ApiProperty()
  nationalNumber: string;

  @ApiProperty()
  verifiedAt: string;
}

export class CountryVaultResponseDto {
  @ApiProperty()
  countryCode: string;

  @ApiProperty()
  countryName: string;

  @ApiProperty()
  flag: string;

  @ApiProperty({ type: [ValidatedNumberResponseDto] })
  numbers: ValidatedNumberResponseDto[];
}

export class ValidatedNumbersVaultResponseDto {
  @ApiProperty({ type: [CountryVaultResponseDto] })
  countries: CountryVaultResponseDto[];

  @ApiPropertyOptional()
  total?: number;
}
