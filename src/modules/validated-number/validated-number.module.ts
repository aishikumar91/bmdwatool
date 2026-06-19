import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ValidatedNumberRecord } from './entities/validated-number.entity';
import { ValidatedNumberService } from './validated-number.service';
import { ValidatedNumberController } from './validated-number.controller';

@Module({
  imports: [TypeOrmModule.forFeature([ValidatedNumberRecord], 'data')],
  controllers: [ValidatedNumberController],
  providers: [ValidatedNumberService],
  exports: [ValidatedNumberService],
})
export class ValidatedNumberModule {}
