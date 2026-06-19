import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddValidatedNumbers1779950000000 implements MigrationInterface {
  name = 'AddValidatedNumbers1779950000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const isPostgres = queryRunner.connection.options.type === 'postgres';
    const exists = await queryRunner.hasTable('validated_numbers');
    if (exists) return;

    if (isPostgres) {
      await queryRunner.query(
        `CREATE TABLE "validated_numbers" (
          "id" varchar PRIMARY KEY NOT NULL DEFAULT gen_random_uuid()::varchar,
          "e164" varchar(32) NOT NULL,
          "whatsappId" varchar(64) NOT NULL,
          "countryCode" varchar(4) NOT NULL,
          "countryName" varchar(120) NOT NULL,
          "flag" varchar(8) NOT NULL,
          "dialCode" varchar(8) NOT NULL,
          "nationalNumber" varchar(32) NOT NULL,
          "verifiedAt" timestamp NOT NULL,
          "createdAt" timestamp NOT NULL DEFAULT NOW()
        )`,
      );
    } else {
      await queryRunner.query(
        `CREATE TABLE "validated_numbers" (
          "id" varchar PRIMARY KEY NOT NULL,
          "e164" varchar(32) NOT NULL,
          "whatsappId" varchar(64) NOT NULL,
          "countryCode" varchar(4) NOT NULL,
          "countryName" varchar(120) NOT NULL,
          "flag" varchar(8) NOT NULL,
          "dialCode" varchar(8) NOT NULL,
          "nationalNumber" varchar(32) NOT NULL,
          "verifiedAt" datetime NOT NULL,
          "createdAt" datetime NOT NULL DEFAULT (datetime('now'))
        )`,
      );
    }

    await queryRunner.query(`CREATE UNIQUE INDEX "IDX_validated_numbers_e164" ON "validated_numbers" ("e164")`);
    await queryRunner.query(`CREATE INDEX "IDX_validated_numbers_countryCode" ON "validated_numbers" ("countryCode")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_validated_numbers_countryCode"`);
    await queryRunner.query(`DROP INDEX "IDX_validated_numbers_e164"`);
    await queryRunner.query(`DROP TABLE "validated_numbers"`);
  }
}
