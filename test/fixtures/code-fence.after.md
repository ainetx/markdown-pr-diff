## Configuration

Set the retry budget before the client is constructed:

```ts
const client = new Client({
  retries: 5,
  timeoutMs: 2500,
  backoff: 'exponential',
});
```

Anything above ten retries is rejected.
