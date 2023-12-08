import {
  Column,
  CreateDateColumn,
  Entity,
  ManyToOne,
  PrimaryGeneratedColumn
} from "typeorm";

import type Address from "./Address";
import type Contact from "./Contact";

interface GiftAddress extends Address {
  size: "XS" | "S" | "M" | "L" | "XL" | "XXL";
}

export class GiftForm {
  @Column()
  firstname!: string;

  @Column()
  lastname!: string;

  @Column()
  email!: string;

  @Column({ type: "date" })
  startDate!: Date;

  @Column({ type: String, nullable: true })
  message!: string | null;

  @Column()
  fromName!: string;

  @Column()
  fromEmail!: string;

  @Column()
  months!: number;

  @Column({ type: "jsonb", nullable: true })
  giftAddress!: GiftAddress | null;

  @Column({ type: "jsonb", nullable: true })
  deliveryAddress!: Address | null;
}

@Entity()
export default class GiftFlow {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @CreateDateColumn()
  date!: Date;

  @Column()
  sessionId!: string;

  @Column({ unique: true })
  setupCode!: string;

  @Column(() => GiftForm)
  giftForm!: GiftForm;

  @Column({ default: false })
  completed!: boolean;

  @Column({ default: false })
  processed!: boolean;

  @ManyToOne("Contact")
  giftee?: Contact;
}
