class Session:
    def subscribe(self):
        """Open a `subscriptions/listen` stream of typed change events.

        Keyword args mirror the wire filter:

            async with client.listen(tools_list_changed=True) as sub:
                async for event in sub:
                    tools = await client.list_tools()

        A graceful close ends the loop.
        """
        raise RuntimeError(
            "resources/subscribe is removed; use Client.listen() instead.",
        )
