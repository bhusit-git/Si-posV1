import { boolean, integer, pgEnum, pgTable, serial, text, uniqueIndex } from "drizzle-orm/pg-core";

export const userRoleEnum = pgEnum("user_role", ["admin", "office", "manager", "factory"]);

export const productTypes = pgTable(
  "product_types",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    nameEn: text("name_en"),
    hasBag: boolean("has_bag").notNull().default(false),
    decreasesBag: boolean("decreases_bag").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    catalogCode: integer("catalog_code"),
    family: text("family"),
    form: text("form"),
    packageType: text("package_type"),
    sizeValue: integer("size_value"),
    sizeUnit: text("size_unit"),
    sizeLabel: text("size_label"),
  },
  (table) => [uniqueIndex("idx_product_types_catalog_code").on(table.catalogCode)]
);

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  role: userRoleEnum("role").notNull().default("office"),
  factoryKey: text("factory_key"),
});
