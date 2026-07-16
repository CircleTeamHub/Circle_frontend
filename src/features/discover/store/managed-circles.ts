type CircleRole = 'OWNER' | 'ADMIN' | 'MEMBER';

type CircleLike = {
  id: string;
};

type JoinedCircleLike = {
  myRole?: CircleRole | null;
};

export function getJoinedCirclesNeedingRoleFallback<
  TCircle extends JoinedCircleLike,
>(circles: TCircle[]): TCircle[] {
  return circles.filter((circle) => circle.myRole == null);
}

type CircleDetailLike = {
  id: string;
  myRole: CircleRole | null;
};

interface DeriveManagedCirclesInput<TCircle extends CircleLike> {
  createdCircles: TCircle[];
  /** 来自 GET /circle/my?tab=joined —— 每项自带 myRole。 */
  joinedCircles: (TCircle & JoinedCircleLike)[];
  /** Compatibility data for older backends that omit myRole from the list. */
  joinedCircleDetails?: CircleDetailLike[];
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
  joinedCircleDetails = [],
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

  const detailRoleByCircleId = new Map(
    joinedCircleDetails.map((detail) => [detail.id, detail.myRole]),
  );

  for (const circle of joinedCircles) {
    if (seenCircleIds.has(circle.id)) {
      continue;
    }
    const role = circle.myRole ?? detailRoleByCircleId.get(circle.id);
    if (role !== 'OWNER' && role !== 'ADMIN') {
      continue;
    }

    managedCircles.push(circle);
    seenCircleIds.add(circle.id);
  }

  return managedCircles;
}
