## Configuration

Set the retry budget before the client is constructed:

```ts
const client = new Client({
  retries: 3,
  timeoutMs: 1000,
});
```

Anything above three retries is rejected.
