import React from "react";
import GroupCard from "../common/GroupCard";
import type { Group } from "../../types";

type GroupsListProps = {
  groups: Group[];
  joinedGroupIds: Set<string>;
  onSelectGroup: (group: Group) => void;
  onPrefetchGroup: (group: Group) => void;
  onPressGroup?: (group: Group) => void;
};

const GroupsList: React.FC<GroupsListProps> = ({
  groups,
  joinedGroupIds,
  onSelectGroup,
  onPrefetchGroup,
  onPressGroup,
}) => {
  if (!groups.length) {
    return (
      <div className="p-4 text-sm text-gray-500">
        No groups found yet. Check back soon.
      </div>
    );
  }

  return (
    <div className="px-4 py-4">
      {groups.map((group) => {
        const hasPreview = Array.isArray(group.memberPreview);
        const membersAvatars = hasPreview
          ? group
              .memberPreview!.slice(0, 6)
              .map((member) => member?.avatar ?? null)
          : undefined;
        const membersTotal =
          typeof group.memberCount === "number"
            ? group.memberCount
            : hasPreview
            ? group.memberPreview!.length
            : 0;
        const joinedKey = group.databaseId || group.id || "";
        const isJoined = Boolean(
          joinedKey &&
            (joinedGroupIds.has(joinedKey) ||
              (group.databaseId ? joinedGroupIds.has(group.databaseId) : false))
        );

        return (
          <GroupCard
            key={group.id}
            group={group}
            onClick={() => onSelectGroup(group)}
            membersAvatars={membersAvatars}
            membersTotal={membersTotal}
            joined={isJoined}
            borderless
            useLatestPreview={false}
            onMouseEnter={() => onPrefetchGroup(group)}
            onPressStart={onPressGroup ? () => onPressGroup(group) : undefined}
          />
        );
      })}
    </div>
  );
};

export default GroupsList;
