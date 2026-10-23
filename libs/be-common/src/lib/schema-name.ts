const SCHEMA_NAME = /^[a-z][a-z0-9_]{0,62}$/;

/** Schema names are interpolated into SQL, so only plain lowercase identifiers are allowed. */
export function assertSchemaName(schema: string): string {
  if (!SCHEMA_NAME.test(schema)) {
    throw new Error(`Invalid schema name "${schema}"`);
  }
  return schema;
}
