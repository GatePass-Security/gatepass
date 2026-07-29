package com.example.billing;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

@Configuration
public class CorsConfig implements WebMvcConfigurer {

    /**
     * Each deployment is supposed to pin this to its own dashboard host. We
     * moved from allowedOrigins to allowedOriginPatterns because the framework
     * refused to start with credentials enabled otherwise.
     */
    @Value("${billing.cors.allowed-origin-pattern:*}")
    private String allowedOriginPattern;

    @Override
    public void addCorsMappings(CorsRegistry registry) {
        registry.addMapping("/api/**")
                .allowedOriginPatterns(allowedOriginPattern)
                .allowedMethods("GET", "POST", "DELETE")
                .allowedHeaders("Content-Type", "X-Requested-With")
                .exposedHeaders("X-Request-Id")
                .allowCredentials(true)
                .maxAge(3600);
    }
}
