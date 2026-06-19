import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, Index } from 'typeorm';

@Entity('validated_numbers')
@Index(['e164'], { unique: true })
@Index(['countryCode'])
export class ValidatedNumberRecord {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 32 })
  e164: string;

  @Column({ type: 'varchar', length: 64 })
  whatsappId: string;

  @Column({ type: 'varchar', length: 4 })
  countryCode: string;

  @Column({ type: 'varchar', length: 120 })
  countryName: string;

  @Column({ type: 'varchar', length: 8 })
  flag: string;

  @Column({ type: 'varchar', length: 8 })
  dialCode: string;

  @Column({ type: 'varchar', length: 32 })
  nationalNumber: string;

  @Column({ type: 'datetime' })
  verifiedAt: Date;

  @CreateDateColumn()
  createdAt: Date;
}
