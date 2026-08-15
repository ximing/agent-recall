Recall relevant memories from the agent-recall service for a query.

## Usage

```
/recall [query]
```

## Instructions

1. Run this with the Bash tool (substitute the user's query, keep it on one line):

```bash
curl -s -m 5 -X POST "${AGENT_RECALL_URL:-http://127.0.0.1:8787}/api/hooks/context" \
  -H "content-type: application/json" \
  -H "authorization: Bearer ${AGENT_RECALL_TOKEN}" \
  -d '{"query": "<query>"}'
```

2. Present the `context` text and the `memories` array from the JSON response.
   Group memories by session/project when present.
3. If the response is empty or the request fails, say so plainly and suggest the
   user check that the agent-recall server is running.
4. **Never hallucinate results.** Only present what the endpoint actually returns.
