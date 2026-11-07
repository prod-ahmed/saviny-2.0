import { handleApi } from "../../../server/http/router";

export const dynamic = "force-dynamic";

/** Every /api request goes through the same dispatcher, whatever the method. */
export const GET = handleApi;
export const POST = handleApi;
export const PATCH = handleApi;
export const PUT = handleApi;
export const DELETE = handleApi;
export const OPTIONS = handleApi;
