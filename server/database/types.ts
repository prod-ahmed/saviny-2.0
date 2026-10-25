/** A stored MongoDB document, read without its _id. Fields are snake_case, as the mappers expect. */
export type Row = Record<string, any>;
