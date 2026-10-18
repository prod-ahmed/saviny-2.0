import { ArrayMaxSize, IsArray, IsBoolean, IsDateString, IsIn, IsNotEmpty, IsNumber, IsOptional, IsPositive, IsString, MaxLength } from "class-validator";

const money = { maxDecimalPlaces: 2 };

export class AccountDto {
  @IsString() @IsNotEmpty() @MaxLength(60) name!: string;
  @IsIn(["checking", "savings", "cash", "credit"]) type!: string;
  @IsNumber(money) initialBalance!: number;
}

export class AccountUpdateDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(60) name?: string;
  @IsOptional() @IsIn(["checking", "savings", "cash", "credit"]) type?: string;
}

export class CategoryDto {
  @IsString() @IsNotEmpty() @MaxLength(40) name!: string;
}

export class TransactionDto {
  @IsIn(["income", "expense"]) type!: string;
  @IsNumber(money) @IsPositive() amount!: number;
  @IsDateString() date!: string;
  @IsOptional() @IsString() @MaxLength(120) description?: string;
  @IsString() accountId!: string;
  @IsString() categoryId!: string;
}

export class TransactionUpdateDto {
  @IsOptional() @IsIn(["income", "expense"]) type?: string;
  @IsOptional() @IsNumber(money) @IsPositive() amount?: number;
  @IsOptional() @IsDateString() date?: string;
  @IsOptional() @IsString() @MaxLength(120) description?: string;
  @IsOptional() @IsString() accountId?: string;
  @IsOptional() @IsString() categoryId?: string;
}

export class BudgetDto {
  @IsString() @IsNotEmpty() @MaxLength(60) name!: string;
  @IsNumber(money) @IsPositive() limit!: number;
  @IsIn(["monthly", "weekly", "custom"]) period!: string;
  @IsOptional() @IsDateString() startDate?: string;
  @IsOptional() @IsDateString() endDate?: string;
  @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) categoryIds!: string[];
}

export class BillDto {
  @IsString() @IsNotEmpty() @MaxLength(80) name!: string;
  @IsNumber(money) @IsPositive() amount!: number;
  @IsDateString() dueDate!: string;
  @IsIn(["bill", "scheduled"]) kind!: string;
  @IsOptional() @IsString() accountId?: string;
}

export class GoalDto {
  @IsString() @IsNotEmpty() @MaxLength(80) title!: string;
  @IsOptional() @IsString() @MaxLength(400) description?: string;
  @IsNumber(money) @IsPositive() targetAmount!: number;
  @IsOptional() @IsDateString() targetDate?: string;
}

export class GoalUpdateDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(80) title?: string;
  @IsOptional() @IsString() @MaxLength(400) description?: string;
  @IsOptional() @IsNumber(money) @IsPositive() targetAmount?: number;
  @IsOptional() @IsDateString() targetDate?: string;
}

export class ContributionDto {
  @IsNumber(money) @IsPositive() amount!: number;
  @IsDateString() date!: string;
  @IsOptional() @IsString() @MaxLength(200) note?: string;
}

export class RecurringDto {
  @IsIn(["income", "expense"]) type!: string;
  @IsNumber({ maxDecimalPlaces: 2 }) @IsPositive() amount!: number;
  @IsOptional() @IsString() @MaxLength(120) description?: string;
  @IsString() accountId!: string;
  @IsString() categoryId!: string;
  @IsIn(["weekly", "monthly", "yearly"]) frequency!: string;
  @IsDateString() nextDate!: string;
}

export class RecurringUpdateDto {
  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional() @IsIn(["weekly", "monthly", "yearly"]) frequency?: string;
  @IsOptional() @IsDateString() nextDate?: string;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @IsPositive() amount?: number;
  @IsOptional() @IsString() @MaxLength(120) description?: string;
}

export class BudgetUpdateDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(60) name?: string;
  @IsOptional() @IsNumber(money) @IsPositive() limit?: number;
  @IsOptional() @IsIn(["monthly", "weekly", "custom"]) period?: string;
  @IsOptional() @IsDateString() startDate?: string;
  @IsOptional() @IsDateString() endDate?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) categoryIds?: string[];
}

export class BillUpdateDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(80) name?: string;
  @IsOptional() @IsNumber(money) @IsPositive() amount?: number;
  @IsOptional() @IsDateString() dueDate?: string;
  @IsOptional() @IsIn(["bill", "scheduled"]) kind?: string;
}
