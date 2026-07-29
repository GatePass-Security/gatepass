using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Acme.Api.Controllers;

[ApiController]
[Route("v1/ledger")]
[Authorize]
public class LedgerController : ControllerBase
{
    [HttpGet("balances")]
    public IActionResult Balances()
    {
        var tenant = User.FindFirst("tenant_id")?.Value;
        return Ok(new
        {
            tenantId = tenant,
            availableCents = 1_284_500,
            pendingCents = 91_200
        });
    }
}
