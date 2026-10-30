"use client";

import { useState, useEffect } from "react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import { useTranslations } from "next-intl";
import { useReorderTeamUsers } from "@/hooks/use-teams";
import { getContractSuffix } from "@/lib/constants/contract-types";
import { tDyn } from "@/i18n/dynamic";

interface User {
  id: string;
  name: string;
  firstName?: string | null;
  color?: string | null;
  contractType?: string | null;
}

interface TeamUsersReorderProps {
  teamId: string;
  users: User[];
  disabled?: boolean;
}

// i18n-dynamic: users.contractTypes.*
function SortableUser({ user, disabled }: { user: User; disabled?: boolean }) {
  const t = useTranslations("users");
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: user.id,
    disabled,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-2 rounded-md border bg-background px-3 py-2"
    >
      {disabled ? (
        <span className="inline-flex items-center text-muted-foreground/40" aria-hidden>
          <GripVertical className="h-4 w-4" />
        </span>
      ) : (
        <button type="button" className="cursor-grab touch-none" {...attributes} {...listeners}>
          <GripVertical className="h-4 w-4 text-muted-foreground" />
        </button>
      )}
      <div
        className="h-4 w-4 shrink-0 rounded-full border border-input"
        style={{ backgroundColor: user.color || "#FFFFFF" }}
      />
      <span className="text-sm">
        {[user.firstName, user.name].filter(Boolean).join(" ")}
        {(() => {
          const suffix = getContractSuffix(user.contractType, (key) => tDyn(t, `contractTypes.${key}`));
          return suffix ? ` [${suffix}]` : "";
        })()}
      </span>
    </div>
  );
}

export function TeamUsersReorder({ teamId, users, disabled }: TeamUsersReorderProps) {
  const t = useTranslations("users");
  const [orderedUsers, setOrderedUsers] = useState<User[]>(users);
  const reorder = useReorderTeamUsers();

  useEffect(() => {
    setOrderedUsers(users);
  }, [users]);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    if (disabled) return;
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = orderedUsers.findIndex((u) => u.id === active.id);
    const newIndex = orderedUsers.findIndex((u) => u.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const newOrder = [...orderedUsers];
    const [moved] = newOrder.splice(oldIndex, 1);
    newOrder.splice(newIndex, 0, moved);
    setOrderedUsers(newOrder);

    reorder.mutate({ teamId, userIds: newOrder.map((u) => u.id) });
  };

  if (orderedUsers.length === 0) {
    return <p className="px-3 py-2 text-xs text-muted-foreground">{t("teams.noMembers")}</p>;
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={orderedUsers.map((u) => u.id)} strategy={verticalListSortingStrategy}>
        <div className="space-y-1 py-2">
          {orderedUsers.map((user) => (
            <SortableUser key={user.id} user={user} disabled={disabled} />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}
