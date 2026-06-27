"""Tests for the dense micro-batcher (concurrent /embed/image coalescing).

The batcher is the GPU-parallelism path: many single-image embed requests that
arrive together must fuse into ONE batched forward pass, while each caller still
gets the embedding for ITS image, in order. These tests monkeypatch the GPU
forward (``_embed_images_batch``) so they stay offline and fast — no model load.
"""
import asyncio

import app


def _reset_batcher():
    # The per-preset queue + drain task bind to the loop that first created them;
    # clear so each test (re)creates them on its own asyncio.run loop.
    app._dense_queues.clear()
    app._dense_tasks.clear()


def test_concurrent_requests_coalesce_into_one_batch(monkeypatch):
    _reset_batcher()
    seen_batch_sizes: list[int] = []

    def fake_batch(images, preset):
        seen_batch_sizes.append(len(images))
        # Encode each stand-in "image" (an int) into its vector so we can assert
        # every caller got the embedding for its own image, in order.
        return [[float(im)] for im in images]

    monkeypatch.setattr(app, "_embed_images_batch", fake_batch)
    # Widen the window so the burst below deterministically coalesces.
    monkeypatch.setattr(app, "DENSE_BATCH_WAIT_MS", 50.0)
    monkeypatch.setattr(app, "DENSE_BATCH_MAX", 16)

    async def run():
        images = list(range(8))
        results = await asyncio.gather(
            *(app._embed_image_batched(im, "vit_h") for im in images)
        )
        for task in app._dense_tasks.values():
            task.cancel()
        return results

    results = asyncio.run(run())

    # All eight fused into a single forward, none dropped.
    assert seen_batch_sizes and max(seen_batch_sizes) > 1
    assert sum(seen_batch_sizes) == 8
    # Each request got its own image's vector, in submission order.
    assert results == [[float(i)] for i in range(8)]


def test_batch_size_is_capped(monkeypatch):
    _reset_batcher()
    seen_batch_sizes: list[int] = []

    def fake_batch(images, preset):
        seen_batch_sizes.append(len(images))
        return [[float(im)] for im in images]

    monkeypatch.setattr(app, "_embed_images_batch", fake_batch)
    monkeypatch.setattr(app, "DENSE_BATCH_WAIT_MS", 50.0)
    monkeypatch.setattr(app, "DENSE_BATCH_MAX", 4)

    async def run():
        results = await asyncio.gather(
            *(app._embed_image_batched(i, "vit_h") for i in range(10))
        )
        for task in app._dense_tasks.values():
            task.cancel()
        return results

    results = asyncio.run(run())

    assert sum(seen_batch_sizes) == 10           # every request served
    assert max(seen_batch_sizes) <= 4            # never exceeds the cap
    assert results == [[float(i)] for i in range(10)]


def test_failure_propagates_to_every_waiter(monkeypatch):
    _reset_batcher()

    def boom(images, preset):
        raise RuntimeError("gpu exploded")

    monkeypatch.setattr(app, "_embed_images_batch", boom)
    monkeypatch.setattr(app, "DENSE_BATCH_WAIT_MS", 20.0)

    async def run():
        tasks = [
            asyncio.create_task(app._embed_image_batched(i, "vit_h"))
            for i in range(3)
        ]
        results = await asyncio.gather(*tasks, return_exceptions=True)
        for task in app._dense_tasks.values():
            task.cancel()
        return results

    results = asyncio.run(run())

    assert len(results) == 3
    assert all(isinstance(r, RuntimeError) for r in results)
