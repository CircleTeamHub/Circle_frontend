type CircleRole = 'OWNER' | 'ADMIN' | 'MEMBER';

type CircleLike = {
  id: string;
};

type JoinedCircleLike = {
  myRole?: CircleRole | null;
};

interface DeriveManagedCirclesInput<TCircle extends CircleLike> {
  createdCircles: TCircle[];
  /** 来自 GET /circle/my?tab=joined —— 每项自带 myRole。 */
  joinedCircles: (TCircle & JoinedCircleLike)[];
}

/**
 * 「我管理的圈子」= 我创建的（我是圈主）+ 我加入且身份是管理员的。
 *
 * joined 项的 myRole 由 GET /circle/my 直接下发。此前这里收的是一个平行的
 * joinedCircleDetails 数组，调用方为了拿角色只能对每个已加入圈子再打一次
 * GET /circle/:id —— 一个无界的 N+1。角色本就在后端的 membership 行上。
 */
export function deriveManagedCircles<TCircle extends CircleLike>({
  createdCircles,
  joinedCircles,
}: DeriveManagedCirclesInput<TCircle>): TCircle[] {
  const managedCircles: TCircle[] = [];
  const seenCircleIds = new Set<string>();

  for (const circle of createdCircles) {
    if (seenCircleIds.has(circle.id)) {
      continue;
    }
    managedCircles.push(circle);
    seenCircleIds.add(circle.id);
  }

  for (const circle of joinedCircles) {
    if (seenCircleIds.has(circle.id)) {
      continue;
    }
    // 角色缺失时保守跳过：宁可不显示，也不误判成管理员。
    if (circle.myRole !== 'OWNER' && circle.myRole !== 'ADMIN') {
      continue;
    }

    managedCircles.push(circle);
    seenCircleIds.add(circle.id);
  }

  return managedCircles;
}
