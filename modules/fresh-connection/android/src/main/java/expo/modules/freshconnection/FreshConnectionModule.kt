package expo.modules.freshconnection

import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.suspendCancellableCoroutine
import okhttp3.Call
import okhttp3.Callback
import okhttp3.ConnectionPool
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import java.io.IOException
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/**
 * 卡住的 GET 的备份请求走这里（见 src/services/api/client.ts 的 sendGet）。
 *
 * React Native 的 OkHttp 把同一域名的请求全塞进一条 HTTP/2 连接；跨境线路一丢包，整条连接
 * 冻住，在上面再发多少次都一样卡，要等心跳判死、重连，十几秒。这里用自己的连接池，和 RN 那个
 * 客户端不共用连接，所以备份一定走一条新连接；原来那条连接和上面的其他请求不受影响。
 *
 * 只做 GET、只回状态码 / 响应头 / 文本 body：JS 侧拿去拼成 Response，后续解析和接口客户端一致。
 * 失败只给固定文案，不带底层错误文本（可能含主机名 / IP）。
 */
class FreshConnectionModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("FreshConnection")

    AsyncFunction("get") Coroutine { url: String, headers: Map<String, String>, timeoutMs: Int ->
      get(url, headers, timeoutMs.toLong().coerceIn(MIN_TIMEOUT_MS, MAX_TIMEOUT_MS))
    }
  }

  private suspend fun get(url: String, headers: Map<String, String>, timeoutMs: Long): Map<String, Any> {
    val request = try {
      Request.Builder().url(url).apply { headers.forEach { (name, value) -> header(name, value) } }.get().build()
    } catch (_: IllegalArgumentException) {
      throw FreshConnectionException()
    }
    val call = client.newBuilder().callTimeout(timeoutMs, TimeUnit.MILLISECONDS).build().newCall(request)
    return suspendCancellableCoroutine { continuation ->
      continuation.invokeOnCancellation { call.cancel() }
      call.enqueue(object : Callback {
        override fun onFailure(call: Call, e: IOException) {
          continuation.resumeWithException(FreshConnectionException())
        }

        override fun onResponse(call: Call, response: Response) {
          val result = try {
            response.use {
              mapOf(
                "status" to it.code,
                "headers" to it.headers.toMultimap().mapValues { (_, values) -> values.joinToString(", ") },
                "body" to (it.body?.string() ?: ""),
              )
            }
          } catch (_: IOException) {
            continuation.resumeWithException(FreshConnectionException())
            return
          }
          continuation.resume(result)
        }
      })
    }
  }

  private class FreshConnectionException : CodedException("ERR_FRESH_CONNECTION", "Fresh connection request failed", null)

  private companion object {
    const val MIN_TIMEOUT_MS = 1_000L
    const val MAX_TIMEOUT_MS = 30_000L

    // 进程级常驻。连接池最多留 2 条空闲连接 30 秒；心跳与 plugins/with-android-okhttp-health 一致。
    val client: OkHttpClient by lazy {
      OkHttpClient.Builder()
        .connectionPool(ConnectionPool(2, 30, TimeUnit.SECONDS))
        .pingInterval(5, TimeUnit.SECONDS)
        .connectTimeout(10, TimeUnit.SECONDS)
        .build()
    }
  }
}
