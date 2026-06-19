import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ValidatedNumberRecord } from './entities/validated-number.entity';
import { SaveValidatedNumberDto } from './dto/validated-number.dto';
import { createLogger } from '../../common/services/logger.service';

export interface CountryVaultGroup {
  countryCode: string;
  countryName: string;
  flag: string;
  numbers: Array<{
    e164: string;
    whatsappId: string;
    countryCode: string;
    countryName: string;
    flag: string;
    dialCode: string;
    nationalNumber: string;
    verifiedAt: string;
  }>;
}

@Injectable()
export class ValidatedNumberService {
  private readonly logger = createLogger('ValidatedNumberService');

  constructor(
    @InjectRepository(ValidatedNumberRecord, 'data')
    private readonly repository: Repository<ValidatedNumberRecord>,
  ) {}

  private toDto(record: ValidatedNumberRecord) {
    return {
      e164: record.e164,
      whatsappId: record.whatsappId,
      countryCode: record.countryCode,
      countryName: record.countryName,
      flag: record.flag,
      dialCode: record.dialCode,
      nationalNumber: record.nationalNumber,
      verifiedAt: record.verifiedAt.toISOString(),
    };
  }

  async findAllGrouped(): Promise<{ countries: CountryVaultGroup[]; total: number }> {
    const records = await this.repository.find({
      order: { countryName: 'ASC', e164: 'ASC' },
    });

    const map = new Map<string, CountryVaultGroup>();
    for (const record of records) {
      const existing = map.get(record.countryCode);
      const dto = this.toDto(record);
      if (existing) {
        existing.numbers.push(dto);
      } else {
        map.set(record.countryCode, {
          countryCode: record.countryCode,
          countryName: record.countryName,
          flag: record.flag,
          numbers: [dto],
        });
      }
    }

    return {
      countries: [...map.values()],
      total: records.length,
    };
  }

  async upsert(dto: SaveValidatedNumberDto): Promise<ValidatedNumberRecord> {
    const verifiedAt = new Date(dto.verifiedAt);
    const existing = await this.repository.findOne({ where: { e164: dto.e164 } });

    if (existing) {
      Object.assign(existing, {
        whatsappId: dto.whatsappId,
        countryCode: dto.countryCode,
        countryName: dto.countryName,
        flag: dto.flag,
        dialCode: dto.dialCode,
        nationalNumber: dto.nationalNumber,
        verifiedAt,
      });
      return this.repository.save(existing);
    }

    const created = this.repository.create({
      e164: dto.e164,
      whatsappId: dto.whatsappId,
      countryCode: dto.countryCode,
      countryName: dto.countryName,
      flag: dto.flag,
      dialCode: dto.dialCode,
      nationalNumber: dto.nationalNumber,
      verifiedAt,
    });

    const saved = await this.repository.save(created);
    this.logger.log('Validated number saved', { e164: saved.e164, countryCode: saved.countryCode });
    return saved;
  }

  async upsertMany(dtos: SaveValidatedNumberDto[]): Promise<number> {
    let saved = 0;
    for (const dto of dtos) {
      await this.upsert(dto);
      saved++;
    }
    return saved;
  }

  async removeByE164(e164: string): Promise<boolean> {
    const result = await this.repository.delete({ e164 });
    return (result.affected ?? 0) > 0;
  }

  async removeByCountry(countryCode: string): Promise<number> {
    const result = await this.repository.delete({ countryCode });
    return result.affected ?? 0;
  }

  async clearAll(): Promise<void> {
    await this.repository.clear();
  }
}
