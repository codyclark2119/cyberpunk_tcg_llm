import { createHash } from "node:crypto";
/** JSON identity: key order is irrelevant; array order is significant. Reject lossy/non-JSON values. */
export function canonicalSerialize(value: unknown): string {
    const ancestors = new Set<object>();
    function encode(item: unknown): string {
        if (item === null)
            return "null";
        if (typeof item === "string" || typeof item === "boolean")
            return JSON.stringify(item);
        if (typeof item === "number" && Number.isFinite(item))
            return JSON.stringify(item);
        if (typeof item !== "object" || item === null)
            throw new TypeError("Canonical values must be finite JSON data");
        if (ancestors.has(item))
            throw new TypeError("Cyclic canonical value");
        ancestors.add(item);
        try {
            if (Array.isArray(item)) {
                if (Object.keys(item).length !== item.length)
                    throw new TypeError("Sparse or decorated arrays are not canonical JSON");
                return "[" + item.map(encode).join(",") + "]";
            }
            if (Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null)
                throw new TypeError("Canonical objects must be plain JSON objects");
            if (Object.getOwnPropertySymbols(item).length)
                throw new TypeError("Symbol keys are not canonical JSON");
            return "{" + Object.keys(item).sort().map((key) => {
                const descriptor = Object.getOwnPropertyDescriptor(item, key);
                if (!descriptor || !("value" in descriptor))
                    throw new TypeError("Accessors are not canonical JSON");
                return JSON.stringify(key) + ":" + encode(descriptor.value);
            }).join(",") + "}";
        }
        finally {
            ancestors.delete(item);
        }
    }
    return encode(value);
}
export function hashCanonical(value: unknown): string {
    return createHash("sha256").update(canonicalSerialize(value)).digest("hex");
}
export const hashCardContent = hashCanonical;
export const hashRulesetContent = hashCanonical;
export const hashCommandRequest = hashCanonical;
