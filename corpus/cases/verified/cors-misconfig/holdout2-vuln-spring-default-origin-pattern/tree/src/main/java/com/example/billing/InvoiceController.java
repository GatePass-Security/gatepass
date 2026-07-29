package com.example.billing;

import java.util.List;
import java.util.Map;

import jakarta.servlet.http.HttpSession;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/invoices")
public class InvoiceController {

    /**
     * Lists the signed-in customer's invoices. Authentication is the servlet
     * session cookie only; there is no bearer token and no CSRF check on reads.
     */
    @GetMapping
    public ResponseEntity<List<Map<String, Object>>> list(HttpSession session) {
        Object customerId = session.getAttribute("customerId");
        if (customerId == null) {
            return ResponseEntity.status(401).build();
        }

        return ResponseEntity.ok(List.of(
                Map.of(
                        "id", "inv_1001",
                        "customer", customerId,
                        "amountCents", 24900,
                        "card", "**** 4242"),
                Map.of(
                        "id", "inv_1002",
                        "customer", customerId,
                        "amountCents", 9900,
                        "card", "**** 4242")));
    }
}
