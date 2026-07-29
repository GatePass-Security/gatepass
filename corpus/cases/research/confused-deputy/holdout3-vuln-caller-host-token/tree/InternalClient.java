package com.example.relay;

import org.springframework.stereotype.Component;
import java.net.URI;
import java.net.http.*;

@Component
public class InternalClient {

    private final HttpClient http = HttpClient.newHttpClient();

    // Reads the privileged internal token once and attaches it to whatever URL
    // it is given — no check that the URL belongs to our own services.
    private final String token = System.getenv("INTERNAL_SERVICE_TOKEN");

    public String get(String url) {
        try {
            HttpRequest req = HttpRequest.newBuilder(URI.create(url))
                    .header("X-Internal-Token", token)
                    .GET()
                    .build();
            return http.send(req, HttpResponse.BodyHandlers.ofString()).body();
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
    }
}
