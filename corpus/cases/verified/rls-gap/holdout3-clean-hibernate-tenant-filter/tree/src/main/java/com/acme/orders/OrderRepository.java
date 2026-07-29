package com.acme.orders;

import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/**
 * No query here mentions tenant_id. The tenantFilter declared on {@link Order}
 * is auto-enabled on every Hibernate session, so the generated SQL always
 * includes the tenant predicate.
 */
public interface OrderRepository extends JpaRepository<Order, String> {

    @Query("select o from Order o where o.status = :status order by o.totalCents desc")
    List<Order> findByStatus(@Param("status") String status);

    @Query("select coalesce(sum(o.totalCents), 0) from Order o where o.status = 'paid'")
    long paidTotalCents();

    List<Order> findTop50ByOrderByTotalCentsDesc();
}
