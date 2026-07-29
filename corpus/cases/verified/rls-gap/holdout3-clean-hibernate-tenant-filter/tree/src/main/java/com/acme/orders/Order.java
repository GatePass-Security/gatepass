package com.acme.orders;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import org.hibernate.annotations.Filter;
import org.hibernate.annotations.FilterDef;
import org.hibernate.annotations.ParamDef;

@Entity
@Table(name = "orders")
@FilterDef(
        name = "tenantFilter",
        parameters = @ParamDef(name = "tenantId", type = String.class),
        autoEnabled = true)
@Filter(name = "tenantFilter", condition = "tenant_id = :tenantId")
public class Order {

    @Id
    @Column(name = "id", nullable = false, updatable = false)
    private String id;

    @Column(name = "tenant_id", nullable = false, updatable = false)
    private String tenantId;

    @Column(name = "status", nullable = false)
    private String status;

    @Column(name = "total_cents", nullable = false)
    private long totalCents;

    protected Order() {
    }

    public String getId() {
        return id;
    }

    public String getTenantId() {
        return tenantId;
    }

    public String getStatus() {
        return status;
    }

    public long getTotalCents() {
        return totalCents;
    }
}
