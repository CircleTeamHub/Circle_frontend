import type { CirclePlazaPost, PlazaPostCardData } from '@/types';

// 把一条广场帖子压成聊天卡片 payload。圈子/城市取主项（circles[0]/cities[0]），
// 兼容后端旧字段 circle/city；标题用正文首段，空正文（纯图帖）回落到给定占位。
export function toPlazaPostCardData(
  post: CirclePlazaPost,
  untitledLabel: string,
): PlazaPostCardData {
  return {
    postId: post.id,
    title: post.content?.trim() || untitledLabel,
    contentPreview: post.content ?? null,
    coverUrl: post.images?.[0] ?? null,
    circleName: post.circles?.[0]?.name ?? post.circle.name,
    city: post.cities?.[0] ?? post.city,
    signupCount: post.signupCount,
    authorNickname: post.author.nickname,
  };
}
