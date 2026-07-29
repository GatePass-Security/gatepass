package com.example.relay;

import org.springframework.web.bind.annotation.*;
import java.util.Map;

// The caller supplies both host and path. The controller hands them straight to
// InternalClient, which stamps the internal service token onto the request.
// Point "host" at an attacker box and the token walks out the door.
@RestController
public class RelayController {

    private final InternalClient client;

    public RelayController(InternalClient client) {
        this.client = client;
    }

    @PostMapping("/relay")
    public Map<String, Object> relay(@RequestBody RelayRequest req) {
        String url = "https://" + req.host() + "/" + req.path();
        String body = client.get(url);
        return Map.of("url", url, "body", body);
    }

    public record RelayRequest(String host, String path) {}
}
