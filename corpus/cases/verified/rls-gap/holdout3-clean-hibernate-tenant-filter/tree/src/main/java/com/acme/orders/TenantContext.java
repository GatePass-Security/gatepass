package com.acme.orders;

/**
 * Request-scoped tenant identity, populated by the authentication filter from
 * the verified JWT claim. Reads fail loudly rather than falling back to a
 * global view when the claim is missing.
 */
public final class TenantContext {

    private static final ThreadLocal<String> CURRENT = new ThreadLocal<>();

    private TenantContext() {
    }

    public static void set(String tenantId) {
        if (tenantId == null || tenantId.isBlank()) {
            throw new IllegalArgumentException("tenantId must be present");
        }
        CURRENT.set(tenantId);
    }

    public static String requireCurrentTenant() {
        String tenantId = CURRENT.get();
        if (tenantId == null) {
            throw new IllegalStateException("no tenant bound to this request");
        }
        return tenantId;
    }

    public static void clear() {
        CURRENT.remove();
    }
}
