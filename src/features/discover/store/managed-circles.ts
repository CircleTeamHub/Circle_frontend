type CircleLike = {
  id: string;
};

type CircleDetailLike = {
  id: string;
  myRole: 'OWNER' | 'ADMIN' | 'MEMBER' | null;
};

interface DeriveManagedCirclesInput<TCircle extends CircleLike> {
  createdCircles: TCircle[];
  joinedCircles: TCircle[];
  joinedCircleDetails: CircleDetailLike[];
}

export function deriveManagedCircles<TCircle extends CircleLike>({
  createdCircles,
  joinedCircles,
  joinedCircleDetails,
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

  const detailByCircleId = new Map(
    joinedCircleDetails.map((detail) => [detail.id, detail.myRole]),
  );

  for (const circle of joinedCircles) {
    if (seenCircleIds.has(circle.id)) {
      continue;
    }

    const role = detailByCircleId.get(circle.id);
    if (role !== 'OWNER' && role !== 'ADMIN') {
      continue;
    }

    managedCircles.push(circle);
    seenCircleIds.add(circle.id);
  }

  return managedCircles;
}
