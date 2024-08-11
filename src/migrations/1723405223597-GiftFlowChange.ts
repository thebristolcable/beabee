import { MigrationInterface, QueryRunner } from "typeorm";

export class GiftFlowChange1723405223597 implements MigrationInterface {
  name = "GiftFlowChange1723405223597";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "gift_flow" ADD "giftFormMonthlyamount" integer NOT NULL DEFAULT 5`
    );
    await queryRunner.query(
      `ALTER TABLE "gift_flow" ALTER COLUMN "giftFormMonthlyamount" DROP DEFAULT`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "gift_flow" DROP COLUMN "giftFormMonthlyamount"`
    );
  }
}
